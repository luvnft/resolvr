import Fuse from "fuse.js";
import { Event, Filter, Kind } from "nostr-tools";

import { useBountyEventStore } from "../stores/eventStore";
import { useProfileStore } from "../stores/profileStore";
import { useRelayStore } from "../stores/relayStore";
import { getTagValues } from "./utils";

const { getApplicantEvent, setApplicantEvent, getZapReceiptEvent, setZapReceiptEvent } = useBountyEventStore.getState();
const { setProfileEvent } = useProfileStore.getState();
const { relayUrl, subscribe } = useRelayStore.getState();

export function retrieveProfiles(pubkey: string[]) {
  const onEvent = (event: Event) => {
    setProfileEvent(relayUrl, event.pubkey, event);
  };

  const onEOSE = () => { };

  const userFilter: Filter = {
    kinds: [0],
    authors: pubkey,
  };

  subscribe([relayUrl], userFilter, onEvent, onEOSE);
}

export function getApplicants(dValues: Set<string>) {
  const applicantFilter: Filter = {
    kinds: [7],
    "#d": Array.from(dValues),
    "#k": ["30050"],
    limit: 1000,
  };

  const onApplicantEvent = (event: Event) => {
    const dValue = getTagValues("d", event.tags);

    const cachedApplicationEvent = getApplicantEvent(relayUrl, dValue, event.pubkey);
    if (!cachedApplicationEvent) {
      setApplicantEvent(relayUrl, dValue, event.pubkey, event);
    }
  };

  const onApplicantEOSE = () => { };

  subscribe([relayUrl], applicantFilter, onApplicantEvent, onApplicantEOSE);
}

export async function getZapEndpoint(metadata: Event<Kind.Metadata>): Promise<null | string> {
  try {
    let lnurl: string = "";
    let { lud16 } = JSON.parse(metadata.content);
    if (lud16) {
      let [name, domain] = lud16.split("@");
      lnurl = `https://${domain}/.well-known/lnurlp/${name}`;
    } else {
      return null;
    }

    let res = await fetch(lnurl);
    let body = await res.json();

    if (body.allowsNostr && body.nostrPubkey) {
      return body.callback;
    }
  } catch (err) {
    /*-*/
  }

  return null;
}

export const fetchInvoice = async (zapEndpoint: any, zapEvent: any) => {
  const comment = zapEvent.content;
  const amount = getTagValues("amount", zapEvent.tags);

  let url = `${zapEndpoint}?amount=${amount}&nostr=${encodeURIComponent(JSON.stringify(zapEvent))}`;

  if (comment) {
    url = `${url}&comment=${encodeURIComponent(comment)}`;
  }

  const res = await fetch(url);
  const { pr: invoice } = await res.json();

  return invoice;
};

export const getZapRecieptFromRelay = async (cachedBountyEvent: Event) => {
  console.log("CALLING GET ZAP RECIEPT FROM RELAY");
  if (cachedBountyEvent) {
    const postedBountyFilter: Filter = {
      kinds: [9735],
      limit: 100,
      "#e": [cachedBountyEvent.id],
    };

    const onEvent = (event: Event) => {
      console.log("zap reciept event", event);
      const bountyValue = getTagValues("value", cachedBountyEvent.tags);
      const zapEvent = JSON.parse(getTagValues("description", event.tags));
      const zapAmount = getTagValues("amount", zapEvent.tags);
      if (Number(bountyValue) === Number(zapAmount) / 1000) {
        console.log("caching zap reciept event", event);
        setZapReceiptEvent(relayUrl, cachedBountyEvent.id, event);
      }
    };

    const onEOSE = () => { };

    subscribe([relayUrl], postedBountyFilter, onEvent, onEOSE);
  }
};

export const filterBounties = (search: string, list: Event[]) => {
  const options = {
    keys: ["content", "tags"],
    includeScore: true,
    distance: 100000,
    includeMatches: true,
    minMatchCharLength: 1,
    threshold: 0.1,
    // ignoreLocation: true,
  };

  if (!search) {
    return list;
  }

  const fuse = new Fuse(list, options);
  const result = fuse.search(search);
  return result.map((r) => r.item);
};
