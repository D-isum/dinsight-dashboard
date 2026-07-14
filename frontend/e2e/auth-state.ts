import { fileURLToPath } from 'node:url';
import path from 'node:path';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));

export const STORAGE_STATE = path.join(e2eDirectory, '..', 'playwright', '.auth', 'user.json');
