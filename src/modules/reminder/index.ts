import autobind from 'autobind-decorator';
import * as loki from 'lokijs';
import Module from '@/module';
import Message from '@/message';
import serifs, { getSerif } from '@/serifs';
import { acct } from '@/utils/acct';
import config from '@/config';

const NOTIFY_INTERVAL = 1000 * 60 * 60 * 1;

export default class extends Module {
	public readonly name = 'reminder';

	private reminds: loki.Collection<{
		userId: string;
		id: string;
		isDm: boolean;
		thing: string | null;
		quoteId: string | null;
		times: number; // 催促した回数(使うのか？)
		createdAt: number;
	}>;

	@autobind
	public install() {
		this.reminds = this.ai.getCollection('reminds', {
			indices: ['userId', 'id']
		});

		return {
			mentionHook: this.mentionHook,
			contextHook: this.contextHook,
			timeoutCallback: this.timeoutCallback
		};
	}

	@autobind
	private async mentionHook(msg: Message) {
		let text = msg.extractedText.toLowerCase();
		if (!text.startsWith('リマインド') && !text.startsWith('todo') && !text.startsWith('これやる')) return false;

		if (text.startsWith('リスト') || text.startsWith('todos')) {
			const reminds = this.reminds.find({
				userId: msg.userId
			});

			const getQuoteLink = id => `[${id}](${config.host}/notes/${id})`;
			if (reminds.length === 0) {
				msg.reply(serifs.reminder.none);
			} else {
				msg.reply(serifs.reminder.reminds + '\n' + reminds.map(remind => `・${remind.thing ? remind.thing : getQuoteLink(remind.quoteId)}`).join('\n'));
			}
			return true;
		}

		if (text.match(/^(.+?)\s(.+)/)) {
			text = text.replace(/^(.+?)\s/, '');
		} else {
			text = '';
		}

		const separatorIndex = text.indexOf(' ') > -1 ? text.indexOf(' ') : text.indexOf('\n');
		const thing = text.substr(separatorIndex + 1).trim();

		if ((thing === '' && msg.quoteId == null) || msg.visibility === 'followers') {
			msg.reply(serifs.reminder.invalid);
			return {
				reaction: '🆖',
				immediate: true
			};
		}

		const remind = this.reminds.insertOne({
			id: msg.id,
			userId: msg.userId,
			isDm: msg.isDm,
			thing: thing === '' ? null : thing,
			quoteId: msg.quoteId,
			times: 0,
			createdAt: Date.now()
		});

		// メンションをsubscribe
		this.subscribeReply(remind!.id, msg.isDm, msg.isDm ? msg.userId : msg.id, {
			id: remind!.id
		});

		if (msg.quoteId) {
			// 引用元をsubscribe
			this.subscribeReply(remind!.id, false, msg.quoteId, {
				id: remind!.id
			});
		}

		// タイマーセット
		this.setTimeoutWithPersistence(NOTIFY_INTERVAL, {
			id: remind!.id
		});

		return {
			reaction: '🆗',
			immediate: true
		};
	}

	@autobind
	private async contextHook(key: any, msg: Message, data: any) {
		if (msg.text == null) return;

		const remind = this.reminds.findOne({
			id: data.id
		});

		if (remind == null) {
			this.unsubscribeReply(key);
			return;
		}

		const done = msg.includes(['done', 'やった', 'やりました', 'はい', 'どね', 'ドネ']);
		const cancel = msg.includes(['やめる', 'やめた', 'キャンセル']);
		const isOneself = msg.userId === remind.userId;

		if ((done || cancel) && isOneself) {
			this.unsubscribeReply(key);
			this.reminds.remove(remind);
			msg.reply(done ? getSerif(serifs.reminder.done(msg.friend.name)) : serifs.reminder.cancel);
			return;
		} else if (isOneself === false) {
			msg.reply(serifs.reminder.doneFromInvalidUser);
			return;
		} else {
			if (msg.isDm) this.unsubscribeReply(key);
			return false;
		}
	}

	@autobind
	private async timeoutCallback(data) {
		const remind = this.reminds.findOne({
			id: data.id
		});
		if (remind == null) return;

		remind.times++;
		this.reminds.update(remind);

		const friend = this.ai.lookupFriend(remind.userId);
		if (friend == null) return; // 処理の流れ上、実際にnullになることは無さそうだけど一応

		let reply;
		if (remind.isDm) {
			this.ai.sendMessage(friend.userId, {
				text: serifs.reminder.notifyWithThing(remind.thing, friend.name)
			});
		} else {
			try {
				reply = await this.ai.post({
					renoteId: remind.thing == null && remind.quoteId ? remind.quoteId : remind.id,
					text: acct(friend.doc.user) + ' ' + serifs.reminder.notify(friend.name),
					visibility: 'specified',
					visibleUserIds: [remind.userId]
				});
				if (reply.id === undefined) {
					const fs = require('fs');
					const path = `${config.memoryDir}`;
					const now = new Date();
					const fillDigit = (num, digit = 2) => {
						return ("0".repeat(digit - 1) + num).slice(-digit);
					}
					try {
						fs.writeFileSync(`${path}/${now.getFullYear()}${fullDigit(now.getMonth())}${fullDigit(now.getDate())}${fullDigit(now.getHours())}${fullDigit(now.getMinutes())}${fullDigit(now.getSeconds())}${fullDigit(now.getMilliseconds(), 3)}.erl`, `${now.toString()}\nerror reply object is this\n${reply}`, 'utf-8');	
					}
					catch (err) {
						this.log(err);
					}
					return;
				}
			} catch (err) {
				// renote対象が消されていたらリマインダー解除
				if (err.statusCode === 400) {
					this.unsubscribeReply(remind.thing == null && remind.quoteId ? remind.quoteId : remind.id);
					this.reminds.remove(remind);
					return;
				}
				return;
			}
		}

		this.subscribeReply(remind.id, remind.isDm, remind.isDm ? remind.userId : reply.id, {
			id: remind.id
		});

		// タイマーセット
		this.setTimeoutWithPersistence(NOTIFY_INTERVAL, {
			id: remind.id
		});
	}
}
