# Gmail Add-on Integration Plan

**Status**: Planning
**Priority**: Post-MVP (after core backend is stable)
**Estimated Effort**: 2-3 weeks

## Overview

Integrate AutoForm AI directly into Gmail as a Workspace Add-on, allowing users to fill PDF forms and reply without leaving their inbox.

## User Flow

### Receiving Email with PDF
1. User receives email with PDF attachment
2. Gmail shows "Fill with AutoForm" button in sidebar/action bar
3. Clicking opens AutoForm AI interface within Gmail

### Filling the Form
4. PDF analyzed by our existing backend
5. Form fields displayed in Gmail sidebar (or modal)
6. User fills fields (auto-populated from profile if available)
7. Real-time preview of filled PDF

### Sending Reply
8. User clicks "Reply with Filled Form"
9. Gmail compose window opens with:
   - Original email quoted
   - Filled PDF attached
   - Optional message: "Completed form attached (filled with AutoForm AI)"
10. User reviews and sends

## Technical Components

### 1. Gmail Add-on (Frontend)

**Technology**: Google Apps Script + modern Add-ons SDK
**Location**: New `/gmail-addon` directory

**Files**:
```
gmail-addon/
├── appsscript.json # Manifest
├── Code.js # Main add-on logic
├── Card.js # UI card construction
├── Auth.js # OAuth handling
└── README.md # Deployment guide
```

**Key Functions**:
- `onGmailMessageOpen(e)` - Detect PDF attachments
- `onFillFormClick(e)` - Send PDF to our API
- `buildFormCard(fields)` - Render form UI
- `onSubmitForm(e)` - Send filled PDF back to Gmail
- `createReplyDraft(pdfBlob)` - Auto-compose reply

### 2. Backend API Extensions

**New Endpoints** (in `/src/app/api/gmail/`):

```typescript
POST /api/gmail/analyze
// Accept PDF from Gmail, return fields
// Auth: Gmail add-on token + user OAuth

POST /api/gmail/fill
// Accept field values, return filled PDF blob
// Auth: Same as above

GET /api/gmail/profile
// Retrieve user's AutoForm profile for auto-fill
// Auth: Same as above
```

### 3. Authentication Flow

**Challenge**: Users need to auth with both Google (via add-on) and AutoForm AI

**Solution**: OAuth 2.0 flow
1. Add-on requests AutoForm AI scope
2. User authorizes once
3. Token stored in Apps Script Properties
4. Subsequent requests include token

**Implementation**:
- Add Google OAuth provider to Supabase
- Create `/api/auth/google` endpoint
- Store Gmail add-on tokens securely

### 4. UI Considerations

**Gmail Add-on UI Constraints**:
- Card-based interface (limited to Gmail's card framework)
- Sidebar is ~400px wide
- Limited styling options

**Options**:
- **Option A**: Pure card-based UI (simpler, native feel)
- **Option B**: Iframe modal (richer experience, like our web app)

**Recommendation**: Start with card-based, add iframe option later

### 5. PDF Handling

**Challenge**: Gmail add-ons can access attachments as `Blob` objects

**Flow**:
```javascript
// In Gmail Add-on
const attachment = message.getAttachments()[0];
const blob = attachment.copyBlob();
const base64 = Utilities.base64Encode(blob.getBytes());

// Send to our API
UrlFetchApp.fetch('https://autoform.ai/api/gmail/analyze', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  payload: { pdf: base64, filename: attachment.getName() }
});
```

**Our API** receives base64, processes as normal

## Development Phases

### Phase 1: Core Add-on (Week 1)
- [ ] Set up Apps Script project
- [ ] Implement PDF detection
- [ ] Build basic card UI
- [ ] Test attachment extraction

### Phase 2: Backend Integration (Week 1-2)
- [ ] Create `/api/gmail/*` endpoints
- [ ] Implement OAuth flow
- [ ] Test PDF upload/download between Gmail and backend
- [ ] Handle error cases gracefully

### Phase 3: Form Filling UX (Week 2)
- [ ] Build card-based form UI
- [ ] Implement field rendering
- [ ] Add auto-fill from profile
- [ ] Real-time validation

### Phase 4: Reply Composition (Week 2-3)
- [ ] Generate filled PDF
- [ ] Create reply draft with attachment
- [ ] Pre-fill reply message
- [ ] Test end-to-end flow

### Phase 5: Polish & Deploy (Week 3)
- [ ] Error handling and loading states
- [ ] Add-on marketplace listing
- [ ] Documentation and onboarding
- [ ] Submit for Google review

## Deployment

### Google Workspace Marketplace
1. Create Cloud project in Google Cloud Console
2. Enable Gmail API
3. Configure OAuth consent screen
4. Deploy Apps Script as add-on
5. Submit for marketplace review (can take 1-2 weeks)

### Distribution Options
- **Public**: Available to all Gmail users (requires Google review)
- **Domain**: Available to specific Google Workspace domains (faster)
- **Private**: Invite-only testing (no review needed)

## Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google review rejection | High | Follow marketplace guidelines strictly, start with domain install |
| Add-on UI too limited | Medium | Provide web app fallback link in card |
| OAuth complexity | Medium | Use Supabase Google provider, extensive testing |
| Gmail API rate limits | Low | Implement queuing, show clear error messages |
| Large PDF handling | Medium | Compress PDFs, show progress indicators |

## Success Metrics

- **Adoption**: % of users who install add-on
- **Engagement**: Forms filled via Gmail vs web app
- **Retention**: Repeat usage of Gmail integration
- **Viral**: New signups from "Filled with AutoForm AI" signatures

## Future Enhancements

1. **Calendar Integration**: Auto-schedule based on form deadlines
2. **Drive Integration**: Save filled forms to specific folders
3. **Template Library**: Pre-configure common forms (W9, I-9, etc.)
4. **Bulk Processing**: Fill multiple forms in one email thread
5. **Smart Routing**: Auto-forward to correct recipient after filling

## Competitive Advantage

- **DocuSign/HelloSign**: They require account creation and setup; we're instant
- **Adobe Fill & Sign**: Doesn't auto-fill from profile or use AI
- **Google Forms**: Not for PDFs, different use case

Our Gmail integration would be the **fastest** way to fill and return a PDF form, period.

## Resources

- [Gmail Add-ons Documentation](https://developers.google.com/gmail/add-ons)
- [Google Apps Script](https://developers.google.com/apps-script)
- [Workspace Marketplace](https://developers.google.com/workspace/marketplace)
- [OAuth 2.0 for Add-ons](https://developers.google.com/apps-script/guides/services/authorization)

## Notes

- This feature would significantly differentiate AutoForm AI from competitors
- Gmail integration is often the #1 requested feature for productivity tools
- Could be a major acquisition opportunity (Google loves buying integrations)
- Start with domain install for early customers, expand to public marketplace later
