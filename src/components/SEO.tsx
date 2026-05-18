import { Helmet } from "react-helmet-async";

const SITE = "https://rainbowcategories.com";
const DEFAULT_IMAGE = `${SITE}/og-image.png`;

interface SEOProps {
  title: string;
  description: string;
  path?: string;            // e.g. "/archive" — joined with SITE for canonical/og:url
  image?: string;           // absolute or site-rooted URL; defaults to og-image
}

export function SEO({ title, description, path = "/", image = DEFAULT_IMAGE }: SEOProps) {
  const url = path.startsWith("http") ? path : `${SITE}${path}`;
  const absoluteImage = image.startsWith("http") ? image : `${SITE}${image}`;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={absoluteImage} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={absoluteImage} />
    </Helmet>
  );
}
