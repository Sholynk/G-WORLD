/** Pages Function — clean article URL without trailing slash. */
import { articlePageHandler } from '../_lib/articles';

export const onRequest = articlePageHandler;
