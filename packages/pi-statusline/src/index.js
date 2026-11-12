import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { homedir } from 'node:os';
import { installUI } from './ui.js';

export default function (pi) {
  installUI(pi, { CustomEditor, truncateToWidth, visibleWidth, home: homedir(), now: Date.now });
}
