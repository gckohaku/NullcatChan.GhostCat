import autobind from 'autobind-decorator';
import delay from 'timeout-as-promise';
import config from '@/config';
import { Note } from '@/misskey/note';
import Module from '@/module';
import Stream from '@/stream';
import includes from '@/utils/includes';
const gomamayo = require('gomamayo-js');

export default class extends Module {
	public readonly name = 'emoji-react';

	private htl: ReturnType<Stream['useSharedConnection']>;

	@autobind
	public install() {
		this.htl = this.ai.connection.useSharedConnection('homeTimeline');
		this.htl.on('note', this.onNote);

		return {};
	}

	@autobind
	private async onNote(note: Note) {
		if (note.reply != null) return;
		if (note.text == null) return;
		if (note.text.includes('@')) return; // (自分または他人問わず)メンションっぽかったらreject

		const react = async (reaction: string, immediate = false) => {
			if (!immediate) {
				await delay(1500);
			}
			this.ai.api('notes/reactions/create', {
				noteId: note.id,
				reaction: reaction
			});
		};

		if (await gomamayo.find(note.text)) return react(config.gomamayo);
		if (includes(note.text, ['ぬるきゃ'])) return react(config.antenna);
		if (
			includes(note.text, [
				'ねむい',
				'ねむたい',
				'ねたい',
				'ねれない',
				'ねれん',
				'ねれぬ',
				'ふむ',
				'つら',
				'死に',
				'つかれた',
				'疲れた',
				'しにたい',
				'きえたい',
				'消えたい',
				'やだ',
				'いやだ',
				'なきそう',
				'泣きそう',
				'辛い'
			])
		)
			return react(config.nadenade);
		if (includes(note.text, ['理解した', 'りかいした', 'わかった', '頑張った', 'がんばった'])) return react(config.erai);
		if (note.text.match(/う[～|ー]*んこ/) || note.text.match(/unko/)) return react(config.unko);
		if (note.text.match(/う[～|ー]*ん$/) || note.text.match(/un$/)) return react(config.ti);
	}
}
