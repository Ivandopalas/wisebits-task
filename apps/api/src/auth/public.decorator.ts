import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Opts a controller or route out of the global access-token guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
