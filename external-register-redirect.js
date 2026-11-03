// The old registration page lived here. The registration form is part of the signing site now (Register tab, with the
// terms on the page and the email check), so old links go there. A `#register=...` fragment with entered data is kept.
location.replace(new URL('./', location.href).href + (location.hash.startsWith('#register') ? location.hash : '#register'));
