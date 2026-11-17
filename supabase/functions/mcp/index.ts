// Vault's MCP server for Claude (claude.ai web and mobile, Claude Desktop, Claude Code).
// Claude signs in through Supabase Auth (OAuth 2.1); every query runs as that user, so RLS keeps each vault private.
// Follows Supabase's "Deploy MCP servers" guide: a fresh server per request, since Edge Functions are stateless.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0';
import { pipeline } from 'npm:@supabase/middleware@1';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1';
import { z } from 'npm:zod@^4.3.6';

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// The same rules as notePath/folderPath in app/server.mjs, so a note Claude writes also syncs to Windows.
function checkPath(path: string, note: boolean): string {
  if (path.length > 400 || (note && !path.endsWith('.md'))) throw new Error(note ? 'la ruta debe ser un archivo .md' : 'carpeta no válida');
  const parts = path.split('/');
  parts.forEach((part, i) => {
    const stem = note && i === parts.length - 1 ? part.slice(0, -3) : part;
    if (!stem || stem.startsWith('.') || stem !== stem.trimStart() || /[. ]$/.test(stem) || /[\\:*?"<>|\u0000-\u001f]/.test(part) || RESERVED.test(stem.split('.')[0])) {
      throw new Error(`nombre no válido: "${part}"`);
    }
  });
  return path;
}

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;
// Escapes LIKE wildcards so a search for "50%" finds that text.
const likeText = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

Deno.serve(
  pipeline([withOAuthProtectedResource(), withSupabase({ auth: 'user' })], async (req, { supabase }) => {
    const notes = () => supabase.from('vault_files').select('path, content, updated_at').eq('kind', 'note').eq('deleted', false);
    const must = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data;
    };
    // One note's row, or null when it does not exist (or is in the trash).
    const find = async (path: string) =>
      must(await supabase.from('vault_files').select('path, content, deleted').eq('path', path).maybeSingle()) as { path: string; content: string; deleted: boolean } | null;
    const save = async (path: string, content: string) =>
      must(
        await supabase
          .from('vault_files')
          .upsert({ path, kind: 'note', content, size: new TextEncoder().encode(content).length, hash: await sha256(content), deleted: false })
          .select('path, updated_at')
          .single(),
      );

    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'vault', version: '1.0.0' });

      server.registerTool(
        'list_notes',
        {
          description: 'Lista las notas del vault (rutas como "Carpeta/Nota.md"). Con folder, solo las que hay dentro de esa carpeta.',
          inputSchema: z.object({ folder: z.string().optional() }),
          annotations: { readOnlyHint: true },
        },
        async ({ folder }) => {
          let q = notes().order('path');
          if (folder) q = q.like('path', `${checkPath(folder.replace(/\/+$/, ''), false).replace(/[\\%_]/g, (c) => `\\${c}`)}/%`);
          const rows = must(await q) as { path: string; updated_at: string }[];
          return text(rows.map((r) => ({ path: r.path, updated: r.updated_at })));
        },
      );

      server.registerTool(
        'search_notes',
        {
          description: 'Busca texto en el nombre y el contenido de las notas. Devuelve la ruta y la línea donde aparece.',
          inputSchema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }),
          annotations: { readOnlyHint: true },
        },
        // shortcut: plain substring match, newest first, no ranking; move to Postgres full-text search if vaults get big.
        async ({ query, limit }) => {
          const [byName, byText] = await Promise.all([
            notes().ilike('path', likeText(query)).order('updated_at', { ascending: false }).limit(limit),
            notes().ilike('content', likeText(query)).order('updated_at', { ascending: false }).limit(limit),
          ]);
          const seen = new Map<string, { path: string; content: string }>();
          for (const r of [...(must(byName) as []), ...(must(byText) as [])] as { path: string; content: string }[]) if (!seen.has(r.path)) seen.set(r.path, r);
          const needle = query.toLowerCase();
          return text(
            [...seen.values()].slice(0, limit).map((r) => ({
              path: r.path,
              line: (r.content ?? '').split('\n').find((l) => l.toLowerCase().includes(needle))?.trim().slice(0, 200) ?? '',
            })),
          );
        },
      );

      server.registerTool(
        'read_note',
        {
          description: 'Lee una nota completa en Markdown (con su frontmatter). path es como "Carpeta/Nota.md".',
          inputSchema: z.object({ path: z.string() }),
          annotations: { readOnlyHint: true },
        },
        async ({ path }) => {
          const row = await find(checkPath(path, true));
          if (!row || row.deleted) throw new Error(`no existe la nota ${path}`);
          return text(row.content ?? '');
        },
      );

      server.registerTool(
        'write_note',
        {
          description:
            'Crea una nota o reemplaza todo su contenido (Markdown; enlaces [[Otra nota]]; propiedades en frontmatter YAML). Para añadir sin borrar lo que hay, usa append_to_note.',
          inputSchema: z.object({ path: z.string(), content: z.string().max(5_000_000) }),
        },
        async ({ path, content }) => text(await save(checkPath(path, true), content)),
      );

      server.registerTool(
        'append_to_note',
        {
          description: 'Añade texto al final de una nota (la crea si no existe).',
          inputSchema: z.object({ path: z.string(), text: z.string().max(1_000_000) }),
        },
        async ({ path, text: extra }) => {
          const row = await find(checkPath(path, true));
          const before = row && !row.deleted ? row.content ?? '' : '';
          const sep = !before || before.endsWith('\n') ? '' : '\n';
          return text(await save(path, `${before}${sep}${extra}`));
        },
      );

      server.registerTool(
        'delete_note',
        {
          description: 'Manda una nota a la papelera (se puede recuperar desde la app).',
          inputSchema: z.object({ path: z.string() }),
          annotations: { destructiveHint: true },
        },
        async ({ path }) => {
          const rows = must(await supabase.from('vault_files').update({ deleted: true }).eq('path', checkPath(path, true)).eq('deleted', false).select('path')) as [];
          if (!rows.length) throw new Error(`no existe la nota ${path}`);
          return text(`${path} está en la papelera`);
        },
      );

      server.registerTool(
        'query_database',
        {
          description:
            'Filas de una base de datos de Vault: las notas que hay directamente dentro de la carpeta de la base, con sus propiedades (frontmatter YAML).',
          inputSchema: z.object({ folder: z.string() }),
          annotations: { readOnlyHint: true },
        },
        async ({ folder }) => {
          const dir = checkPath(folder.replace(/\/+$/, ''), false);
          const rows = must(await notes().like('path', `${dir.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`).order('path')) as { path: string; content: string }[];
          return text(
            rows
              .filter((r) => !r.path.slice(dir.length + 1).includes('/'))
              .map((r) => ({ path: r.path, properties: (r.content ?? '').match(FRONTMATTER)?.[0] ?? '' })),
          );
        },
      );

      return server;
    });

    return handler.fetch(req);
  }),
);
