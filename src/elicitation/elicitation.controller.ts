import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ElicitationEndpointConfiguration, ResolvedElicitationOptions } from './interfaces/elicitation-options.interface';
import { ElicitationService, ELICITATION_MODULE_OPTIONS } from './services/elicitation.service';
import {
  apiKeyFormTemplate,
  confirmationFormTemplate,
  successPageTemplate,
  cancelledPageTemplate,
  errorPageTemplate,
} from './templates';

/**
 * Request body for API key form submission.
 */
interface ApiKeyFormBody {
  elicitationId: string;
  apiKey: string;
}

/**
 * Request body for confirmation form submission.
 */
interface ConfirmationFormBody {
  elicitationId: string;
  action: 'confirm' | 'cancel';
}

/**
 * Factory function to create the elicitation controller with configured endpoints.
 */
export function createElicitationController(
  endpoints: ElicitationEndpointConfiguration = {},
  elicitationModuleId?: string,
) {
  const apiPrefix = endpoints.apiKey?.replace(/^\//, '') ?? 'api-key';
  const confirmPrefix = endpoints.confirm?.replace(/^\//, '') ?? 'confirm';
  const statusPrefix = endpoints.status?.replace(/^\//, '') ?? 'status';

  @Controller()
  class ElicitationController {
    readonly logger = new Logger(ElicitationController.name);

    constructor(
      @Inject(
        elicitationModuleId
          ? `ELICITATION_MODULE_OPTIONS_${elicitationModuleId}`
          : ELICITATION_MODULE_OPTIONS,
      )
      readonly options: ResolvedElicitationOptions,
      @Inject(
        elicitationModuleId
          ? `ElicitationService_${elicitationModuleId}`
          : ElicitationService,
      )
      readonly elicitationService: ElicitationService,
    ) {}

    /**
     * GET /:id/status - Get elicitation status
     */
    @Get(`:id/${statusPrefix}`)
    async getStatus(@Param('id') elicitationId: string) {
      const elicitation = await this.elicitationService.getElicitation(elicitationId);

      if (!elicitation) {
        throw new NotFoundException('Elicitation not found or expired');
      }

      const result = await this.elicitationService.getResult(elicitationId);

      return {
        elicitationId,
        status: elicitation.status,
        createdAt: elicitation.createdAt,
        expiresAt: elicitation.expiresAt,
        completed: result !== undefined,
        result: result ? {
          success: result.success,
          action: result.action,
          completedAt: result.completedAt,
        } : undefined,
      };
    }

    /**
     * GET /:id/api-key - Render API key form
     */
    @Get(`:id/${apiPrefix}`)
    async renderApiKeyForm(
      @Param('id') elicitationId: string,
      @Res() res: Response,
    ) {
      const elicitation = await this.elicitationService.getElicitation(elicitationId);

      if (!elicitation) {
        return this.renderError(res, 'Elicitation not found or expired');
      }

      if (elicitation.status === 'complete') {
        return this.renderError(res, 'This elicitation has already been completed');
      }

      const metadata = elicitation.metadata ?? {};
      const html = apiKeyFormTemplate({
        elicitationId,
        message: (metadata.message as string) ?? 'Please enter your API key to continue.',
        fieldLabel: (metadata.fieldLabel as string) ?? 'API Key',
        placeholder: (metadata.placeholder as string) ?? 'Enter your API key',
        description: metadata.description as string | undefined,
        actionUrl: this.elicitationService.buildElicitationUrl(elicitationId, apiPrefix),
        options: this.options.templateOptions,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }

    /**
     * POST /:id/api-key - Handle API key form submission
     */
    @Post(`:id/${apiPrefix}`)
    @HttpCode(200)
    async submitApiKeyForm(
      @Param('id') elicitationId: string,
      @Body() body: ApiKeyFormBody,
      @Res() res: Response,
    ) {
      const elicitation = await this.elicitationService.getElicitation(elicitationId);

      if (!elicitation) {
        return this.renderError(res, 'Elicitation not found or expired');
      }

      if (elicitation.status === 'complete') {
        return this.renderError(res, 'This elicitation has already been completed');
      }

      const apiKey = body.apiKey;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return this.renderError(res, 'API key is required');
      }

      this.logger.log(`API key submitted for elicitation ${elicitationId}`);

      // Complete the elicitation
      await this.elicitationService.completeElicitation({
        elicitationId,
        success: true,
        action: 'confirm',
        data: { apiKey: apiKey.trim() },
      });

      const html = successPageTemplate({
        title: 'API Key Received',
        message: 'Your API key has been securely received.',
        options: this.options.templateOptions,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }

    /**
     * GET /:id/confirm - Render confirmation page
     */
    @Get(`:id/${confirmPrefix}`)
    async renderConfirmationForm(
      @Param('id') elicitationId: string,
      @Res() res: Response,
    ) {
      const elicitation = await this.elicitationService.getElicitation(elicitationId);

      if (!elicitation) {
        return this.renderError(res, 'Elicitation not found or expired');
      }

      if (elicitation.status === 'complete') {
        return this.renderError(res, 'This elicitation has already been completed');
      }

      const metadata = elicitation.metadata ?? {};
      const html = confirmationFormTemplate({
        elicitationId,
        title: (metadata.title as string) ?? 'Confirm Action',
        message: (metadata.message as string) ?? 'Please confirm you want to proceed.',
        warning: metadata.warning as string | undefined,
        confirmLabel: (metadata.confirmLabel as string) ?? 'Confirm',
        cancelLabel: (metadata.cancelLabel as string) ?? 'Cancel',
        actionUrl: this.elicitationService.buildElicitationUrl(elicitationId, confirmPrefix),
        options: this.options.templateOptions,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }

    /**
     * POST /:id/confirm - Handle confirmation form submission
     */
    @Post(`:id/${confirmPrefix}`)
    @HttpCode(200)
    async submitConfirmationForm(
      @Param('id') elicitationId: string,
      @Body() body: ConfirmationFormBody,
      @Res() res: Response,
    ) {
      const elicitation = await this.elicitationService.getElicitation(elicitationId);

      if (!elicitation) {
        return this.renderError(res, 'Elicitation not found or expired');
      }

      if (elicitation.status === 'complete') {
        return this.renderError(res, 'This elicitation has already been completed');
      }

      const action = body.action;
      if (action !== 'confirm' && action !== 'cancel') {
        return this.renderError(res, 'Invalid action');
      }

      const isConfirmed = action === 'confirm';
      this.logger.log(`Confirmation ${action} for elicitation ${elicitationId}`);

      // Complete the elicitation
      await this.elicitationService.completeElicitation({
        elicitationId,
        success: isConfirmed,
        action,
        data: {},
      });

      let html: string;
      if (isConfirmed) {
        html = successPageTemplate({
          title: 'Confirmed',
          message: 'Your action has been confirmed.',
          options: this.options.templateOptions,
        });
      } else {
        html = cancelledPageTemplate({
          title: 'Cancelled',
          message: 'The action has been cancelled.',
          options: this.options.templateOptions,
        });
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }

    /**
     * Helper to render error pages.
     */
    renderError(res: Response, message: string): void {
      const html = errorPageTemplate({
        title: 'Error',
        message,
        options: this.options.templateOptions,
      });

      res.setHeader('Content-Type', 'text/html');
      res.status(400).send(html);
    }
  }

  return ElicitationController;
}
