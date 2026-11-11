// Test end-to-end de ticket-inspector contra mock local de Discord.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'ticket-inspector'), { recursive: true });
writeFileSync(path.join(tmpDir, 'dsh-home', 'ticket-inspector', 'config.json'), JSON.stringify({ token: 'test-token', guildId: 'g1', ticketParents: ['soporte'], staleHours: 24, maxTickets: 10 }, null, 2), 'utf8');

const now = new Date();
const messagesT1 = [
  { id: '1', content: 'Hola, no puedo descargar la app', author: { username: 'cliente1' }, timestamp: new Date(now.getTime() - 30 * 60_000).toISOString() },
  { id: '2', content: 'Hola, reviso tu caso', author: { username: 'WendigoBot', bot: true }, timestamp: new Date(now.getTime() - 20 * 60_000).toISOString() },
];
const messagesT2 = [
  { id: '3', content: 'Quiero comprar el bot de tickets, sigo esperando', author: { username: 'cliente2' }, timestamp: new Date(now.getTime() - 48 * 3600_000).toISOString() },
];

const mock = http.createServer((req, res) => {
  const route = `${req.method} ${new URL(req.url, 'http://127.0.0.1').pathname}`;
  const json = (s, v) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (route === 'GET /api/v10/users/@me/guilds') return json(200, [{ id: 'g1', name: 'WENDIGO' }]);
  if (route === 'GET /api/v10/guilds/g1/channels') return json(200, [{ id: 'c10', name: 'soporte', type: 15 }, { id: 'c11', name: 'general', type: 0 }]);
  if (route === 'GET /api/v10/guilds/g1/threads/active') return json(200, { threads: [
    { id: 't1', name: 'Ticket descarga', parent_id: 'c10', message_count: 2 },
    { id: 't2', name: 'Ticket compra', parent_id: 'c10', message_count: 1 },
    { id: 't3', name: 'Offtopic', parent_id: 'c11', message_count: 1 },
  ] });
  if (route === 'GET /api/v10/channels/t1/messages') return json(200, messagesT1.slice().reverse());
  if (route === 'GET /api/v10/channels/t2/messages') return json(200, messagesT2.slice().reverse());
  if (route === 'GET /api/v10/channels/t3/messages') return json(200, [{ id: '4', content: 'charla', author: { username: 'x' }, timestamp: now.toISOString() }]);
  json(404, { message: 'mock no soporta ' + route });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${mock.address().port}/api/v10`;

function makeClient(extraEnv = {}) {
  const entry = process.env.TICKETS_SERVER ? path.resolve(process.env.TICKETS_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), DSH_TICKETS_API_BASE: apiBase, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'tickets-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const tickets = await client.callTool({ name: 'tickets', arguments: {} });
console.log('--- tickets ---'); console.log(textOf(tickets));
const summary = await client.callTool({ name: 'summary', arguments: { ticket: 't2' } });
console.log('--- summary t2 ---'); console.log(textOf(summary));
const notFound = await client.callTool({ name: 'summary', arguments: { ticket: 'nope' } });
console.log('ticket inexistente isError:', notFound.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
mock.close();
console.log('OK');
