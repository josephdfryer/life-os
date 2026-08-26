import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — LifeOS',
  description: 'The terms governing use of LifeOS.',
}

export default function TermsOfServicePage() {
  return (
    <div className="marketing-page">
      <div className="marketing-legal">
        <a className="marketing-legal-back" href="/">&larr; LifeOS</a>
        <h1>Terms of Service</h1>
        <p className="marketing-legal-updated">Effective August 15, 2026</p>

        <p>
          These terms govern access to and use of LifeOS (&ldquo;the Service&rdquo;). By signing
          in, you agree to these terms.
        </p>

        <h2>1. The Service</h2>
        <p>
          LifeOS is a personal life-management system. It is invite-only: access is limited to
          account holders explicitly approved by the operator, and it is not offered as a general
          public product with open registration.
        </p>

        <h2>2. Eligibility and account access</h2>
        <p>
          You must sign in with a Google account that has been approved by the operator. The
          operator may add, restrict, or revoke approved accounts at any time, at their sole
          discretion, including without prior notice.
        </p>

        <h2>3. Acceptable use</h2>
        <p>
          You agree not to attempt unauthorized access to the Service or any account other than
          your own, not to misuse or interfere with the Service&rsquo;s operation, and not to use
          the Service for any unlawful purpose.
        </p>

        <h2>4. Your content</h2>
        <p>
          You retain ownership of the content and data you enter into or connect to the Service
          (notes, plans, people, places, events, and similar records). You grant the operator the
          limited right to store and process that content solely to provide the Service to you.
          See the <a href="/privacy">Privacy Policy</a> for how your data is handled.
        </p>

        <h2>5. Third-party services</h2>
        <p>
          The Service integrates with third-party providers &mdash; including Google (Sign-In,
          Gmail, Calendar), Turso, Vercel, and AI providers such as Anthropic &mdash; to deliver
          its features. Your use of those integrations is also subject to each provider&rsquo;s
          own terms.
        </p>

        <h2>6. No warranty</h2>
        <p>
          The Service is a personal project provided &ldquo;as is&rdquo; and &ldquo;as
          available,&rdquo; without warranties of any kind, express or implied, including
          uninterrupted availability or fitness for a particular purpose.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, the operator is not liable for any indirect,
          incidental, or consequential damages arising from your use of, or inability to use, the
          Service.
        </p>

        <h2>8. Termination</h2>
        <p>
          The operator may suspend or terminate your access to the Service at any time, for any
          reason, including revocation of your approved-account status.
        </p>

        <h2>9. Changes to these terms</h2>
        <p>
          These terms may be updated from time to time. Continued use of the Service after a
          change constitutes acceptance of the revised terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Questions about these terms can be sent to{' '}
          <a href="mailto:contact@lacollecteur.com">contact@lacollecteur.com</a>.
        </p>
      </div>
    </div>
  )
}
