import { resolve } from 'node:path';
import { configureAdmin } from '../server/auth.mjs';
await configureAdmin(resolve('.local'), 'admin', process.env.GIVEAWAY_ADMIN_PASSWORD);
console.log('Administrator credentials configured securely');
