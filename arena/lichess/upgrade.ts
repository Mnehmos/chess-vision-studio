// One-off, user-initiated BOT upgrade: `npm run lichess:upgrade`.
//
// IRREVERSIBLE. Only works on an account that has played ZERO games and whose
// token has the bot:play scope. This reads the token from .env (never printed),
// verifies the account, and upgrades ONLY if it isn't already a BOT. Idempotent:
// re-running after a successful upgrade is a safe no-op.
import { LichessClient } from './client';
import { loadLichessConfig, hasToken } from './env';

export async function upgrade(log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  const cfg = loadLichessConfig();
  if (!hasToken(cfg)) {
    throw new Error('No LICHESS_BOT_TOKEN in .env (personal token, scope bot:play). See arena/lichess/README.md.');
  }
  const client = new LichessClient({ token: cfg.token });

  const me = await client.account();
  log(`Account: ${me.username} [id=${me.id}] title=${me.title ?? '(none)'}`);
  if (me.title === 'BOT') {
    log('Already a BOT account — nothing to do. Run `npm run lichess:bot` to play.');
    return;
  }

  log('Upgrading to BOT (irreversible)…');
  const ok = await client.upgradeToBot();
  if (!ok) {
    throw new Error(
      'Upgrade rejected by Lichess. Most common causes: the account has already played a game ' +
        '(upgrade requires ZERO games), or the token is missing the bot:play scope.',
    );
  }

  const after = await client.account();
  log(
    after.title === 'BOT'
      ? `Success — ${after.username} is now a BOT. Next: npm run lichess:account, then npm run lichess:bot.`
      : `Upgrade accepted but title reads ${after.title ?? '(none)'}; re-check on lichess.org.`,
  );
}

if (!process.env.VITEST) {
  upgrade().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
