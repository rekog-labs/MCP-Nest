import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpStreamableHttpService } from '@rekog/mcp-nest';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

// `forRootAsync` does not auto-register transport controllers — NestJS resolves
// controllers synchronously at module-definition time, but async options are
// resolved later. Provide your own controller and inject the MCP service. This
// is the same Custom Controllers pattern used with `forRoot`.
@Controller()
class StreamableHttpController {
  constructor(private readonly mcp: McpStreamableHttpService) {}

  @Post('/mcp')
  handlePost(@Req() req: any, @Res() res: any, @Body() body: unknown) {
    return this.mcp.handlePostRequest(req, res, body);
  }

  @Get('/mcp')
  handleGet(@Req() req: any, @Res() res: any) {
    return this.mcp.handleGetRequest(req, res);
  }

  @Delete('/mcp')
  handleDelete(@Req() req: any, @Res() res: any) {
    return this.mcp.handleDeleteRequest(req, res);
  }
}

@Module({
  imports: [
    McpModule.forRootAsync({
      useFactory: () => ({
        // Pretend these came from a ConfigService or another async source.
        name: process.env.MCP_NAME ?? 'playground-mcp-server-async',
        version: process.env.MCP_VERSION ?? '0.0.1',
      }),
    }),
  ],
  controllers: [StreamableHttpController],
  providers: [GreetingResource, GreetingTool, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3030);

  console.log('MCP server (forRootAsync) started on port 3030');
}

void bootstrap();
