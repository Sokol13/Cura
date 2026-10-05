import { existsSync } from 'node:fs';

export const hasFcpxmlDtd = existsSync(
  new URL('../../../.tmp/fcpxml/FCPXMLv1_7.dtd', import.meta.url),
);
