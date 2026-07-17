import crypto from 'node:crypto';

// Criptografia em repouso das credenciais de providers (tabela ApiCredential).
// AES-256-GCM; a chave deriva de MASTER_KEY (ou JWT_SECRET como fallback),
// nunca é gravada no banco. O auth tag do GCM é anexado ao ciphertext.

function key(): Buffer {
  const source = process.env.MASTER_KEY ?? process.env.JWT_SECRET;
  if (!source) throw new Error('MASTER_KEY ou JWT_SECRET necessário para criptografar credenciais');
  return crypto.createHash('sha256').update(source).digest();
}

export function encryptSecrets(secrets: Record<string, string>): { encrypted: Buffer; iv: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { encrypted, iv };
}

export function decryptSecrets(encrypted: Buffer, iv: Buffer): Record<string, string> {
  const tag = encrypted.subarray(encrypted.length - 16);
  const data = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
