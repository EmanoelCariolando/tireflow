import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ControlConfig {
  port: number;
  serviceName: string | null;
  nssmPath: string;
  productionBranch: string | null;
}

export function parseControlConfig(input: unknown): ControlConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração administrativa inválida.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['port', 'serviceName', 'nssmPath', 'productionBranch'].includes(key))) {
    throw new Error('Opção administrativa desconhecida.');
  }
  const port = value.port ?? 4280;
  const serviceName = value.serviceName ?? null;
  const nssmPath = value.nssmPath ?? 'C:\\Tools\\nssm\\win64\\nssm.exe';
  const productionBranch = value.productionBranch ?? null;
  if (!Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535 ||
    (serviceName !== null && (typeof serviceName !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(serviceName))) ||
    typeof nssmPath !== 'string' || !path.win32.isAbsolute(nssmPath) || !/\\nssm\.exe$/i.test(nssmPath) || /["\r\n\0]/.test(nssmPath) ||
    (productionBranch !== null && (typeof productionBranch !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,100}$/.test(productionBranch) ||
      /\.\.|\/\/|\/$|\.$|\.lock(?:\/|$)/.test(productionBranch)))) {
    throw new Error('Nome do serviço, porta, caminho NSSM ou branch inválidos.');
  }
  return { port: Number(port), serviceName: serviceName as string | null, nssmPath, productionBranch: productionBranch as string | null };
}

export async function loadControlConfig(root: string): Promise<ControlConfig> {
  try { return parseControlConfig(JSON.parse((await readFile(path.join(root, 'control.config.json'), 'utf8')).replace(/^﻿/, ''))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseControlConfig({});
    throw error;
  }
}
