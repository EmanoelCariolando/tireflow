import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DATA_DIRECTORY = path.join(PROJECT_ROOT, 'data');
export const LOG_DIRECTORY = path.join(PROJECT_ROOT, 'logs');
export const BACKUP_DIRECTORY = path.join(PROJECT_ROOT, 'backups');
export const PRODUCT_UPLOAD_DIRECTORY = path.join(PROJECT_ROOT, 'uploads', 'products');
export const DAILY_REPORT_STATE_PATH = path.join(DATA_DIRECTORY, 'daily-report-state.json');
export const PRODUCT_SEED_CSV_PATH = path.join(DATA_DIRECTORY, 'seed', 'initial_products.csv');
