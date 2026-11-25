# FlowGPT Connection Diagnostics Privacy Policy

Effective November 25, 2026.

FlowGPT Connection Diagnostics helps you record and share a report about connection failures on FlowGPT and Emochi. It applies to the extension and its diagnostic reports.

## What the extension records

When you select **Start recording**, the extension records failed requests in the selected tab for up to five minutes. It observes eligible requests to the HTTPS domains flowgpt.com, emochi.com and flow.chat, including their subdomains. A report can include the request URL without credentials, query parameters or fragments, the request time and method, HTTP status, Cloudflare Ray ID and diagnostic headers, and a browser error name. It also includes the VPN or proxy option you choose. The network recorder does not collect cookies, passwords, or request and response bodies.

The extension can include your public IP in a report. It reads it from the matching Cloudflare error page when it is shown. Otherwise, if the failure is recent, it can ask the affected site’s HTTPS Cloudflare trace endpoint for a later measurement. The request sends no cookies or report data. The affected site and Cloudflare receive the network information that accompanies an ordinary request to the endpoint.

If you select an image or ZIP download, the extension captures the visible webpage and saves it to your device with the report. The screenshot can include anything visible on the page. Review it before sharing.

## Storage and sharing

The extension uses this information to diagnose the failures you record. Recording data stays in Chrome’s in-memory session storage. Clearing the report, closing the recorded tab, or restarting Chrome removes the session data. A report or screenshot that you copy or download remains under your control. The extension does not upload reports, screenshots or recordings to the publisher or to support. If you choose to share a report, the recipient receives the copy you send.

The extension does not use diagnostic data for ads, profiling or sale. Its use of user data adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact

For questions about the extension or this policy, contact the publisher through the Chrome Web Store listing.
