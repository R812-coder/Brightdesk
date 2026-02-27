<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy — Notifications for Google Sheets</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7; }
        h1 { font-size: 28px; margin-bottom: 8px; }
        h2 { font-size: 20px; margin-top: 32px; }
        .updated { color: #666; font-size: 14px; margin-bottom: 32px; }
        ul { padding-left: 24px; }
        li { margin-bottom: 8px; }
        .highlight { background: #fff3cd; padding: 16px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
    </style>
</head>
<body>
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: February 26, 2026</p>

    <p>This privacy policy describes how <strong>Notifications for Google Sheets</strong> ("the Add-on") handles your data. We take your privacy seriously and have designed this add-on to minimize data collection and maximize your control.</p>

    <h2>What the Add-on Does</h2>
    <p>Notifications for Google Sheets monitors your Google Sheets for changes (new rows, cell changes, or conditions you define) and sends notifications to messaging platforms (Slack, Discord, or Google Chat) via webhook URLs that you configure.</p>

    <h2>Data We Access</h2>
    <p>The Add-on accesses the following data from your Google Sheets:</p>
    <ul>
        <li><strong>Sheet names and column headers</strong> — to populate the configuration interface</li>
        <li><strong>Cell values in monitored sheets</strong> — to detect changes and evaluate notification rules</li>
        <li><strong>Your email address</strong> — to send you error alert emails if a notification fails</li>
    </ul>

    <div class="highlight">
        <h2 style="margin-top:0;">Data Sent to External Services</h2>
        <p>When a notification rule is triggered, the Add-on sends data from your spreadsheet to the webhook URL you configured. This is the core functionality of the Add-on.</p>
        <ul>
            <li>The Add-on sends notification messages containing cell values, row data, sheet names, and timestamps to <strong>webhook URLs that you provide</strong> (Slack, Discord, or Google Chat).</li>
            <li>The Add-on does <strong>not</strong> choose where data is sent — you provide the webhook URL and control which data triggers notifications.</li>
            <li>The Add-on sends data and does <strong>not</strong> store it on any external server. There is no intermediate server between your Google Sheet and the webhook destination.</li>
            <li>The developer has <strong>no access</strong> to your webhook URLs, notification data, or spreadsheet contents.</li>
        </ul>
    </div>

    <h2>Data Storage</h2>
    <p>All configuration data (notification rules, webhook URLs, polling state, and notification logs) is stored using Google's built-in PropertiesService within your Google Apps Script environment. This data:</p>
    <ul>
        <li>Is stored within Google's infrastructure, associated with your spreadsheet</li>
        <li>Is not transmitted to or stored on any server owned or operated by the developer</li>
        <li>Is accessible only to users with edit access to the spreadsheet</li>
        <li>Can be deleted by removing the Add-on or clearing its properties</li>
    </ul>

    <h2>Data We Do NOT Collect</h2>
    <ul>
        <li>We do not collect or store personal information on external servers</li>
        <li>We do not collect analytics or usage tracking data</li>
        <li>We do not use cookies or tracking technologies</li>
        <li>We do not sell, share, or transfer your data to third parties</li>
        <li>We do not use your data for advertising purposes</li>
    </ul>

    <h2>OAuth Scopes</h2>
    <p>The Add-on requests the following permissions:</p>
    <ul>
        <li><strong>View and manage spreadsheets that this application has been installed in</strong> — to read sheet data for change detection and notifications</li>
        <li><strong>Allow this application to run when you are not present</strong> — to run time-driven polling triggers in the background</li>
        <li><strong>Connect to an external service</strong> — to send webhook notifications to Slack, Discord, and Google Chat</li>
        <li><strong>Send email as you</strong> — to send you error alert emails when a notification fails</li>
        <li><strong>Display and run third-party web content</strong> — to show the configuration sidebar within Google Sheets</li>
    </ul>

    <h2>Data Retention</h2>
    <p>Notification logs (last 50 entries) are stored within Google's PropertiesService for your reference. These logs contain only notification status, timestamps, and truncated message previews. All stored data is deleted when you uninstall the Add-on.</p>

    <h2>Your Rights</h2>
    <p>You can:</p>
    <ul>
        <li>View all notification rules and logs within the Add-on's sidebar</li>
        <li>Delete any notification rule at any time</li>
        <li>Pause all notifications at any time</li>
        <li>Uninstall the Add-on to remove all stored configuration data</li>
        <li>Revoke the Add-on's access via your <a href="https://myaccount.google.com/permissions">Google Account permissions</a></li>
    </ul>

    <h2>Children's Privacy</h2>
    <p>This Add-on is not directed at children under 13 and we do not knowingly collect personal information from children.</p>

    <h2>Changes to This Policy</h2>
    <p>We may update this privacy policy from time to time. Changes will be posted on this page with an updated revision date.</p>

    <h2>Contact</h2>
    <p>If you have questions about this privacy policy or the Add-on's data practices, please contact us at: <strong>sheetnotify-support@googlegroups.com</strong></p>
</body>
</html>
