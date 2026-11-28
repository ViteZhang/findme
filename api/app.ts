import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAppApi } from '../server/api-handler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleAppApi(req, res);
}
