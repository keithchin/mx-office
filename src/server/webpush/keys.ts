// The office's VAPID key pair, made once: the private half in 🔌 Connections' vault (the hidden
// 'web-push-key' credential, DPAPI-encrypted on Windows), the public half in office-settings.json, where
// the phone reads it to subscribe. A private key that doesn't match the public one (one was lost) makes a
// new pair, and every phone subscribes again.

import { createECDH } from 'node:crypto';
import { b64u, generateVapidKeys, unb64u, type VapidKeys } from './crypto.js';
import { connectionsVault, officeSettings, updateOfficeSettings } from '../connections/store.js';

export interface KeySlots {
  getPrivate(): string | undefined;
  setPrivate(v: string): Promise<void>;
  getPublic(): string | undefined;
  setPublic(v: string): void;
}

const officeSlots: KeySlots = {
  getPrivate: () => connectionsVault()?.get('web-push-key'),
  async setPrivate(v) {
    const vault = connectionsVault();
    if (!vault) throw new Error('Connections isn’t open, so there is nowhere safe for the push key');
    await vault.set('web-push-key', v, 'Agent Office');
  },
  getPublic: () => officeSettings().vapidPublicKey,
  setPublic: (v) => void updateOfficeSettings({ vapidPublicKey: v }),
};

/** Whether `pub` is the public half of `priv`. */
function matches(keys: VapidKeys): boolean {
  try {
    const e = createECDH('prime256v1');
    e.setPrivateKey(unb64u(keys.privateKey));
    return b64u(e.getPublicKey()) === keys.publicKey;
  } catch {
    return false;
  }
}

export class VapidStore {
  private making?: Promise<VapidKeys>;
  constructor(private readonly slots: KeySlots = officeSlots) {}

  /** The pair as it is, if there is a good one. */
  current(): VapidKeys | undefined {
    const privateKey = this.slots.getPrivate();
    const publicKey = this.slots.getPublic();
    return privateKey && publicKey && matches({ privateKey, publicKey }) ? { privateKey, publicKey } : undefined;
  }

  /** The pair, made (once, even when asked twice at the same time) when there's none. */
  ensure(): Promise<VapidKeys> {
    const have = this.current();
    if (have) return Promise.resolve(have);
    this.making ??= (async () => {
      const k = generateVapidKeys();
      await this.slots.setPrivate(k.privateKey);
      this.slots.setPublic(k.publicKey);
      return k;
    })().finally(() => (this.making = undefined));
    return this.making;
  }
}
