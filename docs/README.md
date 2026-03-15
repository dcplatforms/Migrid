# MiGrid Documentation Site

This folder contains the GitHub Pages documentation site for MiGrid.

## Features

- **Platform Demonstration** — Embedded video showing the 11-layer microservices architecture in action
- **Linked Source Navigation** — Direct links to every service, package, and migration in the repository
- **Standards Reference** — OpenADR 3.0, OCPP 2.1 (Flagship), OCPI 2.2, ISO 15118, Modbus documentation
- **Quick Start Guide** — Get running in under 5 minutes
- **Responsive Design** — Works on desktop, tablet, and mobile

## Deployment

### Option 1: GitHub Pages (Recommended)

1. **Enable GitHub Pages** in your repository settings:
   - Go to `Settings` → `Pages`
   - Source: `Deploy from a branch`
   - Branch: `main` (or `gh-pages`)
   - Folder: `/docs` (or root)

2. **Move files to `/docs` folder** in your repository:
   ```bash
   mkdir -p docs
   cp -r migrid-docs/* docs/
   git add docs/
   git commit -m "Add GitHub Pages documentation site"
   git push
   ```

3. **Access your site** at `https://migrid-org.github.io/migrid-core/`

### Option 2: Custom Domain

1. Add a `CNAME` file with your domain:
   ```
   docs.migrid.io
   ```

2. Configure DNS:
   - Add a CNAME record pointing to `migrid-org.github.io`
   - Or add A records pointing to GitHub Pages IPs

### Option 3: Local Development

```bash
# Using Python
cd migrid-docs
python -m http.server 8000
# Open http://localhost:8000

# Using Node.js
npx serve migrid-docs
# Open http://localhost:3000
```

## File Structure

```
migrid-docs/
├── index.html          # Main documentation page
├── 404.html            # Custom 404 error page
├── _config.yml         # Jekyll configuration (optional)
└── README.md           # This file
```

## Customization

### Updating the Embedded Artifact

The platform demonstration uses a local video file:

```html
<video 
    src="assets/MiGrid_Platform_Demonstration_Video.mp4" 
    class="embed-frame"
    title="MiGrid Platform Demonstration"
    controls
    autoplay
    muted
    loop
></video>
```

To update, replace the video file in `assets/` and update the `src` attribute.

### Updating Repository Links

All repository links point to `https://github.com/migrid-org/migrid-core`. Update the base URL in `index.html` if your repository is at a different location.

### Color Scheme

The color scheme uses CSS variables defined in `:root`:

```css
:root {
    --bg-primary: #0a0f14;
    --bg-secondary: #111820;
    --accent-cyan: #00e6b8;
    --accent-blue: #00a8ff;
}
```

### Layer Colors

Each layer has a unique color defined via data attributes:

```css
.layer-card[data-layer="L1"] { --layer-color: #22d3d3; }
.layer-card[data-layer="L2"] { --layer-color: #22c55e; }
/* ... etc */
```

## SEO & Metadata

The page includes:
- Open Graph meta tags for social sharing
- Semantic HTML structure
- Descriptive title and meta description
- Favicon (inline SVG)

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

Apache 2.0 — Same as the MiGrid project.
