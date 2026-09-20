# Supported email and calendar providers

## Google
Email: Gmail API, read-only.
Calendar: Google Calendar API, events read-only.
Connector: `ODESSEUS_CONNECT_GOOGLE_CONNECTOR`.

## Microsoft
Email: Microsoft Graph `Mail.Read`.
Calendar: Microsoft Graph `Calendars.Read`.
Connector: `ODESSEUS_CONNECT_MICROSOFT_CONNECTOR`.

## Yahoo
Email: OAuth connector with Yahoo Mail read access, then IMAP over TLS on port 993.
Connector: `ODESSEUS_CONNECT_YAHOO_CONNECTOR`.

## iCloud Mail
Email: IMAP over TLS on `imap.mail.me.com:993`.
Use an Apple app-specific password.
The password is encrypted in Supabase Vault.

## Other email
Email: IMAP over TLS.
User supplies mailbox address, IMAP host, port, and an app/mail password.
The credential is encrypted in Supabase Vault.

## Product behavior
Email and calendar connections are independent. Odesseus normalizes all provider updates into one application signal model.
