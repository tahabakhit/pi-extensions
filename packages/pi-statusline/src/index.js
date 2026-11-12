import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { homedir } from 'node:os';
import { installFooter } from './footer.js';

export default function (pi) {
  installFooter(pi, { truncateToWidth, visibleWidth, home: homedir() });
}
