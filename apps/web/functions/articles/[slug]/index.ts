/** Pages Function — clean article URL with trailing slash (the canonical shape). */
import { articlePageHandler } from '../../_lib/articles';

export const onRequest = articlePageHandler;
