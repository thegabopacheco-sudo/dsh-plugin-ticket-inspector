#!/usr/bin/env node
// dsh-plugin-ticket-inspector — triage de tickets de soporte en Discord.
// Tools: status, tickets, summary.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'ticket-inspector', 'config.json');
const API_BASE = (process.env.DSH_TICKETS_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
const TEXT_TYPES = new Map([[0, 'text'], [5, 'announcement'], [15, 'forum'], [11, 'thread']]);
const log = (m) => process.stderr.write(`[tickets] ${m}\n`);

function loadConfig() {
  const defaults = { token: '', guildId: '', ticketParents: [], staleHours: 24, maxTickets: 30 };
  try { if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch (e) { log(`config: ${e.message}`); }
  return defaults;
}
const tokenOf = (config) => (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim()) || String(config.token || '').trim();
function requireToken(config) { if (!tokenOf(config)) throw new Error(`falta el token del bot: DISCORD_BOT_TOKEN o "token" en ${CONFIG_FILE}`); }

async function discord(config, pathname) {
  requireToken(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, { headers: { authorization: `Bot ${tokenOf(config)}`, 'user-agent': 'dsh-plugin-ticket-inspector/0.1' }, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Discord ${response.status}${data?.message ? `: ${data.message}` : ''}`);
    return data;
  } catch (error) { throw error.name === 'AbortError' ? new Error('Discord timeout') : error; }
  finally { clearTimeout(timer); }
}

async function guildIdOf(config) {
  if (String(config.guildId || '').trim()) return String(config.guildId).trim();
  const guilds = await discord(config, '/users/@me/guilds');
  if (!Array.isArray(guilds) || guilds.length === 0) throw new Error('el bot no está en ningún servidor');
  return guilds[0].id;
}

async function channelsOf(config) {
  const channels = await discord(config, `/guilds/${await guildIdOf(config)}/channels`);
  return (Array.isArray(channels) ? channels : []).map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id || null, typeName: TEXT_TYPES.get(c.type) || String(c.type) }));
}

async function allowedParents(config) {
  const wanted = (config.ticketParents || []).map((x) => String(x).toLowerCase().replace(/^#/, ''));
  const channels = await channelsOf(config);
  return channels.filter((c) => wanted.includes(c.id) || wanted.includes(c.name.toLowerCase()) || wanted.includes(`#${c.name}`.toLowerCase())).map((c) => c.id);
}

async function activeThreads(config) {
  const data = await discord(config, `/guilds/${await guildIdOf(config)}/threads/active`);
  return Array.isArray(data?.threads) ? data.threads : [];
}

async function threadMessages(config, threadId, limit) {
  const data = await discord(config, `/channels/${threadId}/messages?limit=${limit}`);
  return (Array.isArray(data) ? data : []).slice().reverse();
}

function hoursSince(timestamp) {
  const time = Date.parse(timestamp || '');
  if (Number.isNaN(time)) return null;
  return (Date.now() - time) / 3600_000;
}

function snippet(content) { return String(content || '').replace(/\s+/g, ' ').trim().slice(0, 160); }

async function inspectThread(config, thread) {
  const allowed = await allowedParents(config);
  const messages = await threadMessages(config, thread.id, 6);
  const last = messages[messages.length - 1] || null;
  const hours = last ? hoursSince(last.timestamp) : null;
  const lastIsUser = last ? !last.author?.bot : false;
  return {
    id: thread.id,
    name: thread.name || thread.id,
    parentId: thread.parent_id || null,
    inScope: allowed.length === 0 ? true : allowed.includes(thread.parent_id),
    messageCount: thread.message_count ?? messages.length,
    lastAuthor: last?.author?.username || last?.author?.id || 'desconocido',
    lastSnippet: snippet(last?.content),
    lastAt: last?.timestamp || '',
    hoursSinceLast: hours === null ? null : Math.round(hours * 10) / 10,
    unanswered: lastIsUser,
    stale: hours !== null && hours >= Number(config.staleHours || 24),
  };
}

function textResult(t) { return { content: [{ type: 'text', text: t }] }; }

function buildInstructions() {
  return [
    'Ticket Inspector: triage de tickets de soporte de Discord para WENDIGO (solo lectura).',
    '',
    'Herramientas: status, tickets, summary.',
    '',
    'Reglas:',
    '- tickets lista hilos activos de los canales configurados y marca estancados / sin responder.',
    '- summary resume un hilo (cantidad de mensajes, primer pedido, último mensaje) sin inventar respuestas.',
    '- No respondas ni cierres tickets por tu cuenta: sugiere y pide confirmación.',
    '- Nunca leas DMs.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-ticket-inspector', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Token, guild, canales de tickets y umbral de estancamiento.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      return textResult([
        `Token: ${tokenOf(config) ? 'configurado' : 'NO configurado'}`,
        `Config: ${CONFIG_FILE}`,
        `Guild: ${config.guildId || '(primero disponible)'}`,
        `Canales de tickets: ${(config.ticketParents || []).join(', ') || 'todos los hilos activos'}`,
        `Estancado si supera: ${config.staleHours} h · máx. tickets: ${config.maxTickets}`,
      ].join('\n'));
    },
  );

  server.registerTool(
    'tickets',
    { title: 'Listar tickets', description: 'Hilos activos con estado, última actividad y si están sin responder.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      const threads = await activeThreads(config);
      if (threads.length === 0) return textResult('No hay hilos activos.');
      const inspected = [];
      for (const thread of threads.slice(0, config.maxTickets || 30)) inspected.push(await inspectThread(config, thread));
      const inScope = inspected.filter((t) => t.inScope);
      if (inScope.length === 0) return textResult('No hay hilos activos en los canales de tickets configurados.');
      const sorted = inScope.sort((a, b) => Number(b.stale) - Number(a.stale) || Number(b.unanswered) - Number(a.unanswered));
      const flags = (t) => `${t.stale ? '⏰ estancado' : ''}${t.stale && t.unanswered ? ' · ' : ''}${t.unanswered ? '❓ sin responder' : ''}`.trim() || 'al día';
      return textResult([
        `Tickets activos: ${inScope.length}`,
        '',
        ...sorted.map((t) => `#${t.name} (thread ${t.id})\n  ${flags(t)} · última actividad: ${t.lastAt || 'desconocida'}${t.hoursSinceLast !== null ? ` (${t.hoursSinceLast} h)` : ''}\n  último: ${t.lastAuthor}: "${t.lastSnippet}"`),
      ].join('\n'));
    },
  );

  server.registerTool(
    'summary',
    {
      title: 'Resumir ticket',
      description: 'Resume un hilo de tickets: pedido inicial, última actividad y mensajes.',
      inputSchema: z.object({ ticket: z.string().describe('id o nombre del hilo') }),
    },
    async (args) => {
      const config = loadConfig();
      const threads = await activeThreads(config);
      const wanted = String(args.ticket).toLowerCase().replace(/^#/, '');
      const thread = threads.find((t) => t.id === wanted || String(t.name || '').toLowerCase() === wanted);
      if (!thread) throw new Error(`ticket no encontrado: ${args.ticket}`);
      const messages = await threadMessages(config, thread.id, 30);
      const firstUser = messages.find((m) => !m.author?.bot);
      const last = messages[messages.length - 1];
      const participants = [...new Set(messages.map((m) => m.author?.username || m.author?.id || 'desconocido'))];
      const info = await inspectThread(config, thread);
      return textResult([
        `#${thread.name} (${thread.id})`,
        `Mensajes: ${messages.length} · participantes: ${participants.join(', ')}`,
        `Estado: ${info.stale ? 'estancado' : 'activo'}${info.unanswered ? ' · último mensaje del usuario (sin respuesta del bot)' : ' · último mensaje del bot'}`,
        '',
        `Pedido inicial${firstUser ? ` (${firstUser.author?.username || 'usuario'})` : ''}:`,
        firstUser ? snippet(firstUser.content) || '(sin texto)' : '(sin mensajes de usuario)',
        '',
        'Último mensaje:',
        last ? `${last.author?.username || 'desconocido'}: ${snippet(last.content) || '(sin texto)'} (${last.timestamp})` : '(sin mensajes)',
      ].join('\n'));
    },
  );

  return server;
}

try {
  if (!existsSync(CONFIG_FILE)) { mkdirSync(path.dirname(CONFIG_FILE), { recursive: true }); writeFileSync(CONFIG_FILE, JSON.stringify({ token: '', guildId: '', ticketParents: [], staleHours: 24, maxTickets: 30 }, null, 2) + '\n', 'utf8'); }
} catch (e) { log(`init: ${e.message}`); }
log(`config: ${CONFIG_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
