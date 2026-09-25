# Oracle Cloud Always Free deployment - LFF Shopify Backend

This folder prepares the backend for a free Oracle Cloud VM.

## Recommended Always Free VM

- Image: Ubuntu 24.04 LTS, or the newest Ubuntu LTS marked Always Free eligible.
- Shape: Ampere A1 ARM.
- Size: 2 OCPU / 12 GB RAM.
- Boot volume: keep it inside the Always Free allowance.
- Public IPv4: enabled.

Oracle's current Always Free docs list Ubuntu and Always Free networking/storage resources. For Ampere A1, use the conservative current limit of 2 OCPU / 12 GB RAM unless the console explicitly shows more Always Free capacity.

## OCI network rules

In the VM subnet security list or network security group, allow:

- TCP 22 from your IP only when possible.
- TCP 80 from `0.0.0.0/0`.
- TCP 443 from `0.0.0.0/0`.

The install script also enables the matching Ubuntu firewall rules.

## DNS

Create this DNS record in IONOS after Oracle gives the public IP:

```text
backend.lafabricafriki.es  A  <ORACLE_PUBLIC_IP>
```

Do not change the root domain or `www`; those already belong to Shopify.

## Server install

Upload or clone this project to the VM, then run:

```sh
sudo bash deploy/oracle/install-vm.sh
sudo nano /opt/lff/.env
docker compose -f deploy/oracle/docker-compose.yml up -d --build
```

Then pull the first vision model:

```sh
bash deploy/oracle/pull-ollama-model.sh llava:7b
```

If the VM is slow, keep the image search marked beta. Ollama on free CPU is useful for testing and low traffic, not instant recognition.

## Shopify config after DNS works

Set the app URL to:

```text
https://backend.lafabricafriki.es
```

Redirect URLs:

```text
https://backend.lafabricafriki.es/auth/callback
https://backend.lafabricafriki.es/auth/shopify/callback
https://backend.lafabricafriki.es/api/auth/callback
```

Then run:

```sh
npm run deploy -- --allow-updates
```

Finally reinstall/update the app in Shopify Admin.
