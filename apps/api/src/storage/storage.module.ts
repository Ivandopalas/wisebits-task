import { Module } from '@nestjs/common';
import { GridFsVideoStorage } from './gridfs-video-storage.js';
import { VideoStorage } from './video-storage.js';

@Module({
  providers: [{ provide: VideoStorage, useClass: GridFsVideoStorage }],
  exports: [VideoStorage],
})
export class StorageModule {}
