import { z } from 'zod';
import { ZOD_SCHEMA_KEY } from '../pipes/zod-validation.pipe';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters long'),
});

export type CreateUserType = z.infer<typeof createUserSchema>;

export class CreateUserDto {
  static readonly [ZOD_SCHEMA_KEY] = createUserSchema;
  static readonly schema = createUserSchema;

  email!: string;
  name!: string;
}
