/** Pages Function — /help_&_support (serves help_&_support.html with origin metadata). */
import { presentationPage } from './_lib/presentation';

export const onRequest = presentationPage('/help_&_support.html', '/help_&_support');
