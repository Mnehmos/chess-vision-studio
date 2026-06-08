// Read-only token check: `npm run lichess:account`. Verifies LICHESS_BOT_TOKEN
// works and reports whether the account has been upgraded to BOT yet. Plays
// nothing, changes nothing — safe to run any time while setting up.
import { LichessClient } from './client';
import { loadLichessConfig, hasToken } from './env';

export async function showAccount(log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  const cfg = loadLichessConfig();
  if (!hasToken(cfg)) {
    throw new Error('No LICHESS_BOT_TOKEN in .env (personal token, scope bot:play). See arena/lichess/README.md.');
  }
  const me = await new LichessClient({ token: cfg.token }).account();
  log(`id:       ${me.id}`);
  log(`username: ${me.username}`);
  log(`title:    ${me.title ?? '(none)'}`);
  log(
    me.title === 'BOT'
      ? 'This account is a BOT — ready to play. Run `npm run lichess:bot`.'
      : 'Not a BOT yet. Upgrade ONLY a gameless account:\n  curl -d "" https://lichess.org/api/bot/account/upgrade -H "Authorization: Bearer <TOKEN>"',
  );
}

if (!process.env.VITEST) {
  showAccount().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
