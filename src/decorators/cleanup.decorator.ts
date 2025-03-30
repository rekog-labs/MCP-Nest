import { SetMetadata } from "@nestjs/common";
import { MCP_CLEANUP_METADATA_KEY } from "./constants";

export const Cleanup = () => {
  return SetMetadata(MCP_CLEANUP_METADATA_KEY, {});
};
