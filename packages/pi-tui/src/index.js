import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { installEditor } from './editor.js';
import { installTimestamps } from './timestamps.js';

export default function (pi) {
  installEditor(pi, { CustomEditor });
  installTimestamps(pi, { truncateToWidth, visibleWidth, now: Date.now });
}
