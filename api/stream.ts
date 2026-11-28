import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleStreamApi } from '../server/api-handler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleStreamApi(req, res);
}
