/** Pages Function — /privacy_policy (serves privacy_policy.html with origin metadata). */
import { presentationPage } from './_lib/presentation';

export const onRequest = presentationPage('/privacy_policy.html', '/privacy_policy');
