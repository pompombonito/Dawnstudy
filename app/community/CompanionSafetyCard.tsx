import { ExternalLink, Mail, Phone } from "lucide-react";
import { supportContacts, type SafetyInfo } from "./companion-safety";

export default function CompanionSafetyCard({ info }: { info: SafetyInfo }) {
  const contacts = (Array.isArray(info.contacts) ? info.contacts : []).filter(
    (id) => Object.hasOwn(supportContacts, id),
  );
  if (!contacts.length) return null;
  return (
    <section
      className={`companion-help ${info.emergency ? "urgent-help" : ""}`}
      role={info.emergency ? "alert" : undefined}
      aria-label="Philippine help contacts"
    >
      <h4>
        {info.emergency
          ? "Get help now · Philippines"
          : "Support in the Philippines"}
      </h4>
      {info.emergency && <p>If anyone is in immediate danger, call 911 now.</p>}
      <div className="companion-help-contacts">
        {contacts.map((id) => {
          const contact = supportContacts[id];
          return (
            <div key={id}>
              <strong>{contact.name}</strong>
              <small>{contact.detail}</small>
              <div>
                <a className="help-contact-link" href={contact.href}>
                  {id === "ceu" ? <Mail size={14} /> : <Phone size={14} />}{" "}
                  {contact.label}
                </a>
                <a
                  href={contact.source}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`About ${contact.name}`}
                  title="Contact information"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <small className="companion-help-note">
        Dawnstudy cannot call, email or send help for you. Email is not an
        emergency service.
      </small>
    </section>
  );
}
