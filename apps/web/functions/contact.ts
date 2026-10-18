/** Pages Function — /contact (serves contact.html with origin metadata). */
import { presentationPage } from './_lib/presentation';

export const onRequest = presentationPage('/contact.html', '/contact');
