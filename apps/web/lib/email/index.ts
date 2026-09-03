export {
  ConsoleMailer,
  DEFAULT_SMTP_PORT,
  getMailer,
  MAIL_FROM,
  type Mail,
  type Mailer,
  type MailerSettings,
  type MailerStatus,
  mailerKindFor,
  mailerSettings,
  mailerStatus,
  NoopMailer,
  ResendMailer,
  SmtpMailer,
  type SmtpSettings,
  setMailer,
} from './mailer'
export {
  deletionScheduledMail,
  passwordChangedMail,
  resetPasswordMail,
  verifyEmailMail,
} from './templates'
