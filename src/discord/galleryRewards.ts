import type { Db } from '../db/client.js';
import { galleryRewards } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { invalidateGalleryPosts, sameGalleryPost, settleGalleryRewards } from '../services/galleryRewards.js';
import { DiscordHttpError, type DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';

export class GalleryRewardsApp {
  private running = false;
  constructor(private readonly db: Db, private readonly discord: DiscordActions) {}
  async tick() {
    if (this.running) return;
    this.running = true;
    try { await settleGalleryRewards(this.db, this.discord); }
    finally { this.running = false; }
  }
  async onUpdate(messageId: string) {
    const [row] = await this.db.select().from(galleryRewards).where(and(eq(galleryRewards.messageId, messageId), eq(galleryRewards.status, 'pending')));
    if (!row || !this.discord.galleryMessage) return;
    try {
      if (!sameGalleryPost(row, await this.discord.galleryMessage(row.channelId, row.messageId))) await invalidateGalleryPosts(this.db, [row.messageId]);
    } catch (err) {
      if (err instanceof DiscordHttpError && err.status === 404) await invalidateGalleryPosts(this.db, [row.messageId]);
      else logger.warn({ err }, 'gallery post check failed');
    }
  }
}
