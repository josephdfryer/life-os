import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — LifeOS',
  description: 'How LifeOS collects, uses, and protects your data.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="marketing-page">
      <div className="marketing-legal">
        <a className="marketing-legal-back" href="/">&larr; LifeOS</a>
        <h1>Privacy Policy</h1>
        <p className="marketing-legal-updated">Effective August 15, 2026</p>

        <p>
          LifeOS (&ldquo;the Service,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a personal
          life-management system. Access to the Service is limited to account holders explicitly
          approved by the operator &mdash; it is not a public product with open registration. This
          policy explains what information the Service collects from an approved account holder,
          how it is used, and how it is protected.
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li>
            <strong>Account information.</strong> When you sign in with Google, we receive your
            name, email address, and profile photo, used solely to authenticate you and identify
            your account.
          </li>
          <li>
            <strong>Connected Google data.</strong> If you choose to connect Gmail or Google
            Calendar, the Service reads your own messages and calendar events to power
            organizational features (for example, surfacing commitments or communications for
            your review). This only happens for accounts that explicitly authorize the
            connection, and only your own data is accessed.
          </li>
          <li>
            <strong>Content you provide.</strong> Notes, plans, people, places, events, health
            data synced from Apple Health via the companion app, location data, and any other
            information you enter or connect for your own personal use.
          </li>
        </ul>

        <h2>2. How we use information</h2>
        <p>
          Information is used exclusively to operate the Service for the account holder it belongs
          to: authentication, organizing and displaying your own data, and generating
          personalized, on-demand insights about your own life. We do not use your data for
          advertising, and we do not sell it. Some features may send relevant content to
          third-party AI providers (such as Anthropic&rsquo;s Claude API) to generate assistant
          responses or summaries on your behalf; that content is transmitted only to fulfill your
          request.
        </p>

        <h2>3. Google API Limited Use disclosure</h2>
        <p>
          LifeOS&rsquo;s use and transfer of information received from Google APIs to any other
          app will adhere to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>4. Data storage and security</h2>
        <p>
          Data is stored in a private database (Turso) and served over encrypted connections
          (HTTPS/TLS) via Vercel. Access is restricted to approved account holders and is
          protected by Google sign-in; the operator does not share database credentials or raw
          data access with third parties.
        </p>

        <h2>5. Data sharing</h2>
        <p>
          We do not sell your personal data. We do not share it with third parties except: (a)
          infrastructure and service providers strictly necessary to run the Service (hosting,
          database, and AI providers used to power specific features you invoke), each bound by
          their own confidentiality and data-handling terms, or (b) where required by law.
        </p>

        <h2>6. Data retention and deletion</h2>
        <p>
          Your data is retained while your account remains active. You may request deletion of
          your account and associated data, or revoke a connected Google integration, at any time
          by contacting{' '}
          <a href="mailto:contact@lacollecteur.com">contact@lacollecteur.com</a>.
        </p>

        <h2>7. Children&rsquo;s privacy</h2>
        <p>
          The Service is not directed at children under 13, and we do not knowingly collect
          information from them.
        </p>

        <h2>8. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be reflected by
          updating the effective date above.
        </p>

        <h2>9. Contact</h2>
        <p>
          Questions about this policy can be sent to{' '}
          <a href="mailto:contact@lacollecteur.com">contact@lacollecteur.com</a>.
        </p>
      </div>
    </div>
  )
}
