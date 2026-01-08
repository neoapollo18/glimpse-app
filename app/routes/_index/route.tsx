import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Gleame - AI Product Visualizations</h1>
        <p className={styles.text}>
          Let customers see how they'll look with your products using AI-powered transformations. Increase conversions by letting shoppers try before they buy.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>AI Transformations</strong>. Customers upload photos and see realistic results with your products using advanced AI technology.
          </li>
          <li>
            <strong>Instant Setup</strong>. Configure products with simple transformation prompts in minutes. No technical knowledge required.
          </li>
          <li>
            <strong>Boost Conversions</strong>. Proven to increase purchase confidence and reduce returns by letting customers visualize products on themselves.
          </li>
        </ul>
      </div>
    </div>
  );
}
