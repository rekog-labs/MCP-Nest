
export interface IValidationAdapter {
  /**
   * Validates the given data against a schema.
   * @param schema The schema to validate against (e.g., a Zod schema or a class-validator class).
   * @param data The data to validate.
   * @returns A promise that resolves to a success or error object.
   */
  validate(
    schema: any,
    data: any,
  ): Promise<{ success: true; data: any } | { success: false; error: any }>;

  /**
   * Converts the given schema into a JSON Schema representation.
   * @param schema The schema to convert.
   * @returns A promise that resolves to the JSON Schema object.
   */
  toJsonSchema(schema: any): Promise<any>;
}
