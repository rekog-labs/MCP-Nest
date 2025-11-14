import { IValidationAdapter } from '../interfaces/validation-adapter.interface';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Module, Type } from '@nestjs/common';
import { NestApplication, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

@Module({})
class DummyModule {}

export class ClassValidatorAdapter implements IValidationAdapter {
  private app: NestApplication;

  async validate(
    schema: Type<any>,
    data: any,
  ): Promise<{ success: true; data: any } | { success: false; error: any }> {
    const instance = plainToInstance(schema, data);
    const errors = await validate(instance);

    if (errors.length > 0) {
      return { success: false, error: this.formatErrors(errors) };
    }
    return { success: true, data: instance };
  }

  async toJsonSchema(schema: Type<any>): Promise<any> {
    if (!this.app) {
      this.app = await NestFactory.create(DummyModule, { logger: false });
      this.app.useLogger(false);
    }

    const config = new DocumentBuilder().build();
    const document = SwaggerModule.createDocument(this.app, config, {
      extraModels: [schema],
    });

    const jsonSchema = document.components?.schemas?.[schema.name];

    if (jsonSchema && 'title' in jsonSchema) {
      delete jsonSchema.title;
    }

    return jsonSchema;
  }

  private formatErrors(errors: any[]) {
    return errors.map((err) => ({
      path: err.property,
      message: err.constraints
        ? Object.values(err.constraints).join(', ')
        : 'Validation failed',
    }));
  }
}
