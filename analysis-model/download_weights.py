"""Fetch the official Kinetics-400 backbone into this project's models folder."""
from judo_model import make_encoder

if __name__ == "__main__":
    model, _ = make_encoder()
    print(f"Backbone ready: {sum(p.numel() for p in model.parameters())} parameters", flush=True)
