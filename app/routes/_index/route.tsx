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
        <h1 className={styles.heading}>Gleame: product match quizzes</h1>
        <p className={styles.text}>
          A quiz page for your Shopify store. Shoppers answer a few questions and get products matched to them, ready to add to cart.
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
            <strong>Built from your catalog</strong>. Gleame drafts the questions and the matching from your products. You can edit all of it.
          </li>
          <li>
            <strong>Matches you control</strong>. Pin products to answers, or let rules and AI pick the best fit for each shopper.
          </li>
          <li>
            <strong>Results you can measure</strong>. See which answers and recommendations lead to add-to-carts and orders.
          </li>
        </ul>
      </div>
    </div>
  );
}
