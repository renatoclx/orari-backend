import { Module } from "@nestjs/common";
import { LocalFileStorage } from "./local-file-storage.service";

@Module({
  providers: [LocalFileStorage],
  exports: [LocalFileStorage],
})
export class StorageModule {}
