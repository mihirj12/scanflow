import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/** Must run before any Zod schema used in OpenAPI registration is constructed. */
extendZodWithOpenApi(z);
