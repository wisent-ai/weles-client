#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import tarfile
import urllib.error
import urllib.parse
import urllib.request

OWNER = "wisent-ai"
REPOSITORY = "weles-client"


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Stado delivery did not provide {name}")
    return value


def api(path: str, token: str, method: str = "GET", body: bytes | None = None):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{OWNER}/{REPOSITORY}{path}", data=body, method=method,
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "stado-release-delivery", "X-GitHub-Api-Version": "2022-11-28"},
    )
    with urllib.request.urlopen(request) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def main() -> None:
    token = required("WISENT_MIRROR_TOKEN")
    version = required("WISENT_VERSION")
    platform = required("WISENT_PLATFORM")
    archive = pathlib.Path(required("WISENT_RELEASE_ARCHIVE"))
    release_uri = required("WISENT_RELEASE_URI")
    release_sha256 = required("WISENT_RELEASE_SHA256")
    output = pathlib.Path(required("WISENT_OUTPUT_DIR"))
    output.mkdir(parents=True, exist_ok=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != release_sha256:
        raise RuntimeError("local canonical archive does not match the Stado digest")
    with tarfile.open(archive, "r:gz") as bundle:
        member = next((item for item in bundle.getmembers() if item.name.endswith("SOURCE_REVISION")), None)
        if member is None:
            raise RuntimeError("canonical Stado archive has no SOURCE_REVISION")
        source = bundle.extractfile(member)
        revision = source.read().decode("ascii").strip() if source else ""
    if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
        raise RuntimeError("canonical Stado archive contains an invalid source revision")

    tag = f"v{version}"
    encoded_tag = urllib.parse.quote(tag, safe="")
    try:
        ref = api(f"/git/ref/tags/{encoded_tag}", token)
        if ref["object"]["sha"] != revision:
            raise RuntimeError(f"existing {tag} does not identify canonical source {revision}")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        api("/git/refs", token, "POST", json.dumps({"ref": f"refs/tags/{tag}", "sha": revision}).encode())
    try:
        release = api(f"/releases/tags/{encoded_tag}", token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        release = api("/releases", token, "POST", json.dumps({"tag_name": tag, "name": f"Weles client {version}", "body": f"Optional mirror of {release_uri}", "draft": False, "prerelease": False}).encode())

    asset_name = f"weles-client-{version}-{platform}.tar.gz"
    if asset_name not in {asset["name"] for asset in release.get("assets", [])}:
        query = urllib.parse.urlencode({"name": asset_name})
        upload = urllib.request.Request(
            f"https://uploads.github.com/repos/{OWNER}/{REPOSITORY}/releases/{release['id']}/assets?{query}", data=archive.read_bytes(), method="POST",
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "Content-Type": "application/gzip", "User-Agent": "stado-release-delivery", "X-GitHub-Api-Version": "2022-11-28"},
        )
        with urllib.request.urlopen(upload) as response:
            json.load(response)

    receipt = {
        "schema_version": 1, "channel": "github-mirror", "product": required("WISENT_PRODUCT"), "version": version,
        "platform": platform, "source_revision": revision, "release_uri": release_uri, "release_sha256": release_sha256,
        "release_manifest_uri": required("WISENT_RELEASE_MANIFEST_URI"), "release_manifest_sha256": required("WISENT_RELEASE_MANIFEST_SHA256"),
        "external_url": release["html_url"], "asset": asset_name,
    }
    (output / "github-mirror-receipt.json").write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
