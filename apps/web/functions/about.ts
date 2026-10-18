/** Pages Function — /about (serves about.html with origin metadata). */
import { presentationPage } from './_lib/presentation';

export const onRequest = presentationPage('/about.html', '/about');
